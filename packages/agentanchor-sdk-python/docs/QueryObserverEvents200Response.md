# QueryObserverEvents200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**List[ObserverEvent]**](ObserverEvent.md) |  | [optional] 

## Example

```python
from agentanchor.models.query_observer_events200_response import QueryObserverEvents200Response

# TODO update the JSON string below
json = "{}"
# create an instance of QueryObserverEvents200Response from a JSON string
query_observer_events200_response_instance = QueryObserverEvents200Response.from_json(json)
# print the JSON string representation of the object
print(QueryObserverEvents200Response.to_json())

# convert the object into a dict
query_observer_events200_response_dict = query_observer_events200_response_instance.to_dict()
# create an instance of QueryObserverEvents200Response from a dict
query_observer_events200_response_from_dict = QueryObserverEvents200Response.from_dict(query_observer_events200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


