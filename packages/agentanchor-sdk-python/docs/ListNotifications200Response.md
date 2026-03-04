# ListNotifications200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | **List[object]** |  | [optional] 
**unread_count** | **int** |  | [optional] 

## Example

```python
from agentanchor.models.list_notifications200_response import ListNotifications200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListNotifications200Response from a JSON string
list_notifications200_response_instance = ListNotifications200Response.from_json(json)
# print the JSON string representation of the object
print(ListNotifications200Response.to_json())

# convert the object into a dict
list_notifications200_response_dict = list_notifications200_response_instance.to_dict()
# create an instance of ListNotifications200Response from a dict
list_notifications200_response_from_dict = ListNotifications200Response.from_dict(list_notifications200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


