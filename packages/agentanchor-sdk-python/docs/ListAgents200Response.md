# ListAgents200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**List[Agent]**](Agent.md) |  | [optional] 
**meta** | [**PaginationMeta**](PaginationMeta.md) |  | [optional] 

## Example

```python
from agentanchor.models.list_agents200_response import ListAgents200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListAgents200Response from a JSON string
list_agents200_response_instance = ListAgents200Response.from_json(json)
# print the JSON string representation of the object
print(ListAgents200Response.to_json())

# convert the object into a dict
list_agents200_response_dict = list_agents200_response_instance.to_dict()
# create an instance of ListAgents200Response from a dict
list_agents200_response_from_dict = ListAgents200Response.from_dict(list_agents200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


